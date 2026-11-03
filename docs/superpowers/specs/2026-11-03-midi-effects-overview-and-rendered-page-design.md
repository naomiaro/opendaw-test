# MIDI effects overview and the Rendered page — design

An overview page for the MIDI effect demos, modelled on Warp: Who Bends?, and a third sub-demo
under it that shows exactly what the engine emits from a chain of stock MIDI effects: onset and
end to the sample, pitch with cents, and velocity. The MIDI Effects demo and the Spielwerk demo
become its other two sub-demos and keep their URLs.

## Why

The MIDI Effects demo (PR #189) draws an "as emitted" lane by sampling the engine's held-note set
once per frame. That answers "is this pitch sounding now" and nothing more: the lane carries no
velocity and its timing is a frame coarse (about 16 ms). So the Velocity device's Random control
appears to do nothing on the page, Magnet and Offset show only in the sound, and Zeitgeist's
shifts of 24 ms show only roughly. The user asked on 2026-11-03 whether Random does anything at
all; it does (seeded jitter of ±amount per note, position-locked), and the page cannot show it.

The semantics audit (PR #193) built a library that reads an offline render back as notes with
velocity and cents, exact and about a second per two-bar pattern, on a Nano playing a pure sine.
That reader is the second source this page is built on. The audit also established how the
devices behave, two of them against their manuals (openDAW#524, #525); the overview is where a
visitor learns that before opening a sub-demo.

The brainstorm settled the source: what the engine actually renders, not what the rule predicts.
It also settled that this is a separate page on the audit's instrument rather than a probe swap
inside the MIDI Effects demo, so that what plays on the page is what the reader reads.

## Goals

- A visitor moves a Velocity control and, within about a second, sees every note's emitted
  velocity change: as bar colour in the rendered lane and as stem height in a velocity strip
  under it, each emitted stem against a ghost stem of the written velocity.
- Zeitgeist's shifts, Pitch's semitones and cents, and the Arpeggio's steps show at the
  engine's own precision.
- The two engine-vs-manual deviations the audit filed are visible as the engine does them.
- The overview states the piano-roll conventions a reader brings (bars on a pitch grid, length
  is duration, colour is velocity, a velocity strip below) and says, per sub-demo, what each
  page can and cannot show against them.
- The MIDI Effects demo says plainly that its emitted lane breaks the velocity convention, and
  why, and points at the Rendered page.
- The shared note lane shades by velocity on a colour ramp (Ableton's approach: pale when soft,
  saturated when loud) so that a 0.6 against a 1.0 is visible at a glance; the MIDI Effects
  page's written lane gains this too.

## Non-goals

- No Spielwerk on the Rendered page; the chain controls are the four stock devices, as on the
  MIDI Effects page. (A Spielwerk render would need the live-context compile header; its own
  page covers it.)
- No judging. The page shows the read notes; it does not compare them with a rule or a
  register. The audit page does that.
- No MIDI hardware input, no audio effects, no persistence across loads.
- No change to the audit library's behaviour. The demo imports it; the library never imports
  demo code. A pure helper the page needs (reading a live box's settings into a `DeviceSetting`,
  the inverse of `applySettings`) may be added to the library with its own Node tests.
- No polyphonic reader. Where notes overlap the page says so; it does not guess.

## Anti-goals

- A rendered bar whose edge was placed by the rule but drawn as if measured. Rule-placed
  boundaries (abutting notes) are drawn dashed; measured ones solid.
- A render triggered by every tick of a slider drag. Edits settle first.
- A lane that silently shows a stale render after a change. While stale it says so.
- Prose on the overview or the pages that restates a manual as fact where the engine differs.
  Where the manual and the engine disagree, the page says what the engine does and links the
  issue.

## Constraints

- The console design language (`docs/design/2026-06-11-mastering-console-editorial.md`;
  reference implementation `src/demos/warp/warp-overview.tsx` for the overview) and the
  "Adding a New Demo" checklist in CLAUDE.md, for both new pages (HTML entry with meta tags and
  `og:image`, Vite input, index card, sitemap, GoatCounter, README table row and source-tree
  listing).
- `renderOfflineSlice` is the only render path; it copies the live project. The reader is
  `src/lib/audit/midiEffectSemanticsReader.ts` as it stands; the instrument and calibration
  are the audit's (`buildNanoProject`, `sineSample`, `calibrationFrom`).
- Every repo rule in CLAUDE.md applies: Option types, `editing.modify`, transaction staleness
  (a box created in one transaction is read in the next), terminate every subscription, no
  per-frame `setState`, `npm run typecheck` exits 0, tests in Node where logic allows.
- Edits under `src/` reload a dev page; nothing here changes that.

## The overview page (decided)

- A new listed page, `midi-effects-demos.html` → `src/demos/midi/midi-effects-overview.tsx`,
  built like the warp overview: kicker, title, a lead paragraph, one card per sub-demo with an
  index, a colour chip, a name, a one-line "what you see", prose, and an Open link; then prose
  sections below the cards.
- Three cards, in this order: MIDI Effects (`/midi-effects-demo.html`), Rendered (the new page),
  Spielwerk (`/spielwerk-demo.html`).
- The lead or first prose section states the piano-roll conventions: notes are bars on a pitch
  grid, a bar's length is the note's duration, a bar's colour is its velocity (pale soft,
  saturated loud), and a velocity strip under the roll shows one stem per note whose height is
  the velocity; openDAW's own note editor, Ableton, Logic and Cubase all do this, and the pages
  here follow it where they can.
- Each card's prose says what that page shows against those conventions. MIDI Effects: hear the
  devices on a synth; the written lane follows the conventions; the emitted lane is read from
  the engine once per frame, shows pitch and timing coarsely and cannot show velocity, so it
  draws every bar one colour. Rendered: the same chain on a pure sine, rendered offline and read
  back, exact; velocity, cents, timing; one voice at a time. Spielwerk: write the device
  yourself.
- A prose section carries what the audit established about the devices, in sentences: a MIDI
  effect is a pull link the instrument draws events through; the Arpeggio walks the absolute
  grid; a velocity of 0 is silence; the Pitch drops a note shifted out of 0..127; and the two
  filed deviations, each linked: openDAW#524 (the Arpeggio's velocity control: the manual says
  −100 % is full velocity, the engine is silent at −100 % and at the note's own velocity at 0 %)
  and openDAW#525 (Zeitgeist moves note-offs as well as note-ons; the manual says durations
  stay). Link the chapter doc `documentation/16-midi.md` and the audit note
  `debug/2026-11-03-midi-effect-semantics/note.md` where the page lists sources.
- The index gets ONE card for the overview in place of the two cards MIDI Effects and Spielwerk
  have now, as Warp has one. The two existing pages stay at their URLs and stay in the sitemap
  and the README table (the README rows say they are sub-demos of the overview, as the warp
  row does for its four).
- The `BackLink` on the three sub-demos keeps pointing at the index, as the warp sub-demos'
  do (`BackLink` has no target). Each sub-demo's kicker reads like the warp ones ("MIDI 01 —
  Effects · OpenDAW SDK", "MIDI 02 — Rendered", "MIDI 03 — Spielwerk"), and the intro
  paragraph of each sub-demo links the overview in one sentence, so a visitor who landed on a
  sub-demo can find the other two.

## The MIDI Effects page (decided)

- The emitted lane's caption and the Velocity card's `listenFor` say that the lane breaks the
  velocity convention: it is read from the engine's held-note set once per frame, which carries
  no velocity, so every bar is one colour; and that the Rendered page shows velocity. Keep the
  existing wording about Arpeggio steps, Pitch moves and Zeitgeist "only roughly".
- The written lane shades on the new colour ramp (it comes with the shared component).
- **The region moves to bar 2** (`REGION_POSITION_PPQN`, where the audit and the Rendered page
  put it), with the loop area, the restart seek and the two lanes' position mapping following
  (region-local). Reason: the Arpeggio walks the ABSOLUTE grid (`step = floor(k / repeat)`,
  `k` the grid index from the project start), so a region at 0 and one at bar 2 play a
  different walk phase for any `repeat` that does not divide 16, and "a setting means the same
  thing on both pages" would be false for those. With both regions at bar 2 the two pages and
  the audit agree. `EmittedBars.sample` receives a region-local position. Nothing else on the
  page changes.

## The Rendered page (decided)

**Files.** `midi-effects-rendered-demo.html` → `src/demos/midi/midi-effects-rendered-demo.tsx`.
Title "Rendered" on the overview card; the page's own title is the builder's wording along the
lines of "MIDI Effects: Rendered". (The page name is my call; the user has not named it.)

**Instrument and boot.** `buildNanoProject` with the audit's constants: a 440 Hz sine, root key
69, 1 ms attack and release, the region at the audit's position (bar 2, `REGION_POSITION_PPQN`)
and duration. The page is audible on Play, looping the pattern (the loop area from the region's
start to its end; a restart seeks to the region's start; the lanes map positions region-local),
with a playhead over the lanes, as the MIDI Effects page. The pattern's bpm is the shared
`PATTERN_BPM`. Two departures from the audit's boot, both this design's calls:

- **The sample is 20 s long**, not the audit's 4 s (`SAMPLE_SECONDS` stays the audit's; the page
  has its own constant). The Nano does not loop the sample, so a note played high above the root
  runs out of sample: a Bass quarter at +84 semitones plays the sine at about 19 times its rate
  and needs 9.5 s. At 20 s every pattern note holds up to pitch 121 and the Melody's and
  Sixteenths' notes up to 127; beyond that (a held Chords note arpeggiated at a slow rate and
  shifted to the top of the range) the engine ends the note when the sample ends and the reader
  reads that end as measured. The page's CLAUDE.md records the limit; the page does not detect it.
- **The Master Maximizer stays on the LIVE project and is removed on the render copy.** Without
  it a Chords triad at velocity 0.8 sums to about 1.7 at the destination and clips the live
  output, and lowering the unit's volume would push quiet notes under the reader's absolute
  floors. `renderOfflineSlice` gains an optional `mutateCopy?: (copy: Project) => void` called
  after the copy and before the renderer is created; the page passes `removeMasterMaximizer`
  through the adapter layer on the copy (assert it removed one). The render is then level-true
  and unclipped (Float32), the calibration reads it, and the live path limits chords as the
  studio would. The page says in one sentence that the live output carries the master limiter
  and the render does not.

**Rendering while the transport plays** is allowed by this design and has not been measured:
the audit page never plays live. The copy is main-thread work and the render runs in the
offline worker. The plan includes a measurement on the built page (play the Sixteenths, drag a
Velocity control, watch the output for a dropout and the frame gap) before the page is called
done. If a render audibly disturbs playback, the fallback rule is: a request that arrives while
the transport plays renders at the next stop (the rows marked stale until then), and the page
says so in the stale caption. The hook's tests cover both rules only if the fallback is
needed.

**Controls.** The MIDI Effects page's pattern select and chain controls, reused through the
shared libraries (`pageState`, `chain`, `devices`, `patterns`, `useMidiChain`,
`MidiEffectCard`, `MidiEffectStack`): the four patterns (Chords, Sixteenths, Melody, Bass), the
single-device tabs and the drag-sortable stack. A setting means the same thing on both pages.

**The patterns leave a gap.** The reader finds notes by the silence between them, and the sine
has a 1 ms release, so notes written end to start (the Melody's eighths, the Bass's quarters)
read as one run; the audit windows those by the rule, which would put the rule in charge of
their timing on this page and hide a Zeitgeist's shift and the note-off deviation on two of the
four patterns. So the Rendered page plays the four patterns with every note shortened to 90 %
of its written length, derived from the shared patterns by one pure function (e.g.
`withGaps(pattern, 0.9)` in `patterns.ts`, Node-tested), never by editing the shared ones: the
audit's rows and register import the shared patterns as they are. On the Melody that is a 25 ms
gap at the pattern's bpm, on the Bass 100 ms, on the Sixteenths nothing changes (they are
already a 1/32 note at a 1/16 step; apply the function anyway so the rule is uniform). The
pattern blurb or the written lane's caption on this page says the notes are shortened to leave
a gap for the reader. The one remaining abutting case is an Arpeggio at gate 1 (its steps touch
whatever the pattern); gate above 1 overlaps. Those keep the rule-windowed treatment below, and
the Arpeggio card's `listenFor` on this page can say that a gate under 1 makes every step's
timing measured.
Lift shared page code out of `midi-effects-demo.tsx` rather than copying it where that is
clean; where lifting would make the MIDI Effects page worse, copy and say so in the PR.

**Three rows**, stacked, one range, one playhead:

1. **As written.** The region's notes, bars on the ramp by written velocity. The lane as it is.
2. **As rendered.** One bar per note the reader read from the last offline render: from its
   onset to its end in pulses (converted from frames at the pattern's bpm with the calibration's
   instrument offset netted), at its read pitch, on the ramp by its read velocity. A Pitch's
   cents, when the read residual is not 0 within the reader's tolerance, as a small label on
   the bar (e.g. "+25¢"). A note the engine silenced (the written note has no read counterpart
   and the rule predicts velocity 0 for it) as a hollow outline at its written place. Abutting
   notes, whose boundaries the rule placed, with dashed vertical edges.
3. **Velocity strip.** Under the rendered lane, the same width and time axis: one ghost stem per
   written note at its written velocity (faint, the structural colour), one solid stem per
   rendered note at its read velocity on the ramp. Stems at the note's onset; the ghost at the
   written onset, the solid at the read onset, so a Zeitgeist's shift shows in the strip too. A
   silenced note has a ghost and no solid stem.

Each row has a title and a caption in the lane component's style. The rendered lane's caption
names the source: "read back from an offline render of the chain: onset, end, pitch, cents,
velocity".

**The ramp.** `NoteLane` gains a velocity colour ramp in place of the opacity scale: a bar's
fill interpolates from a pale, low-saturation tint at velocity 0 to the lane's full accent at
velocity 1 (openDAW squares the velocity before mapping; do the same so the loud end spreads).
The exact endpoints are the builder's, tuned on the dark background against the palette in
`src/lib/design/consoleTheme.ts` (`CANVAS_COLORS`), with the soft end still readable against
the grid. `shadeByVelocity={false}` draws one solid colour as today. The strip's stems use the
same ramp function, exported from one place.

**When it renders.** A render is requested by any change to the chain (insert, remove, enable,
reorder), to a device parameter, or to the pattern. Requests coalesce: the page waits until no
request has arrived for 300 ms, then renders once. If a render is in flight when a request
arrives, the request waits and one more render follows the current one (never a queue deeper
than one). From the first request until the render that includes it lands, the rendered lane
and the strip are marked stale (dimmed, caption "rendering…"); they keep the last result under
the dimming rather than going blank. A render failure shows its message in the lane's place and
in the console (strings, not objects) and clears on the next successful render. The parameter
change hook subscribes to every parameter field of every device in the chain through the
device adapters (re-subscribing when the chain changes), not a comparison of `DeviceSetting`s:
`DeviceSetting` leaves the Velocity's `randomSeed` out by design, and the Reseed button must
re-render. It must not fire a render per animation frame or per slider tick; the 300 ms settle
absorbs a drag.

**Default pattern.** The Rendered page opens on Melody: it is one voice, its velocities ramp so
every Velocity control shows at once, and a Pitch shift is obvious on a tune. The MIDI Effects
page keeps Chords (the stack an Arpeggio walks). "Same controls" is about what a setting means,
not where the page opens; and a page that opened on Chords would open on the overlap sentence
and photograph that way for its `og:image`.

**Calibration.** Once per page load, after boot and before the first render of the visitor's
chain: a dry render of the Sixteenths pattern read through `calibrationFrom` (reference peak,
instrument offset), as the audit does. A failed calibration is an error state for the rendered
rows with its message; the written lane and the sound still work.

**What the reader cannot read.** Readability is decided per note by the rule's
`markReadability` on the chain's predicted notes. The prediction used is the variant with
EVERY known deviation of the chain's devices applied (`DEVIATIONS` for the devices present),
not the audit's intent variant: this page shows what the engine does, and the engine's
variant is the one whose windows and silences match the render. On the intent variant an
Arpeggio at velocity −100 % predicts full velocity where the engine is silent (no hollow
outline would be drawn, the lane would just go blank), and a Zeitgeist's predicted note-offs
would sit where the engine does not put them. The audit tries every subset and judges; this
page predicts once and only to window and mark, so the engine's variant is the right one:

- `polyphonic` / `overlap` (the Chords pattern without an Arpeggio; an Arpeggio at gate 2):
  the rendered lane and strip show no bars for the affected span and a sentence in the lane:
  "The reader reads one voice at a time: these notes overlap. Add an Arpeggio, or pick a
  one-voice pattern." Notes outside the overlapping span still read.
- `too-short` / `too-quiet`: the note is drawn as a hollow outline with the reason in a tooltip
  or a short label; no velocity stem.
- `abutting` (an Arpeggio at gate 1; the written patterns never abut on this page, see "The
  patterns leave a gap"): read at the predicted span with `readWindow`, as the audit does;
  dashed edges on the bar.
- Everything else: `readNotes` on the render, each read note matched to a predicted note by
  nearest onset within the reader's tolerance. A read note with no predicted counterpart is
  still drawn (solid, at what was read) when it lies outside every unreadable span; one that
  lies inside an unreadable span (the merged blob `readNotes` returns for a chord, with a null
  or jittery pitch) is dropped with that span, because it is not a note.

The rule is used here for windows and readability only, never for what is drawn as a value:
pitch, cents, velocity, and every solid edge come from the render. The `RuleContext` is built
from the live adapters exactly as the audit page builds it (`computeVelocity` from the
`VelocityDeviceBoxAdapter`, `warp` from the Zeitgeist's groove, the range from
`renderRange`), through a helper that reads each live box's settings into a `DeviceSetting`.

## Housekeeping in the same PR

- Delete `docs/superpowers/specs/2026-11-03-midi-effects-demos-design.md` and
  `docs/superpowers/plans/2026-11-03-spielwerk-demo.md`: their work merged in PRs #189 and
  #190 and the repo rule says the completing PR deletes them. This PR completes the follow-up
  they set aside. Delete this design and its plan at the end of this PR too.
- Update `src/demos/midi/CLAUDE.md` with what the builder learns that is not in the code
  (the render-on-settle pattern, the ramp, the readability display), and the memory entry.
- Screenshots for `og:image` on both new pages.

## Left to the builder

- The ramp's endpoints and the strip's geometry (stem width, row height), tuned on the page.
- The settle time (300 ms is the design's figure; the builder may tune it between 200 and 500
  and say so).
- How the settings reader and the render-and-read step are factored: the design expects one
  pure module under `src/lib/midiEffects/` (e.g. `renderedNotes.ts`) that takes the render's
  channel, the calibration, the predicted notes and returns the lane's notes, the stems and the
  readability sentences, Node-tested with synthetic renders from `sineSample` as the reader's
  tests do; and one hook on the page that owns the request coalescing, testable in jsdom with
  fake timers.
- Whether the overview's conventions prose includes a small inline diagram (the warp overview
  has a lattice); not required.
- The page's `og:image` composition and the index card blurb wording.
