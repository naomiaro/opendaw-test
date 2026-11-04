/**
 * The MIDI overview's piano-roll primer: four small rolls that each add one idea, then the note
 * objects beside the bars they draw. Static SVG, no engine. The Melody is the demos' own pattern and
 * the shading is the lanes' own `velocityColor`, so what this page teaches is what the demos draw.
 */
import { useState } from "react";
import { MidiKeys, PPQN } from "@opendaw/lib-dsp";
import { patternById, BAR_PPQN, type PatternNote } from "@/lib/midiEffects/patterns";
import { velocityColor } from "@/lib/midiEffects/velocityColor";

const LOW_PITCH = 60;
const HIGH_PITCH = 71;
const ROWS = HIGH_PITCH - LOW_PITCH + 1;
const KEY_WIDTH = 18;
const BLACK_KEY_WIDTH = KEY_WIDTH * 0.6;
const KEY_GAP = 2;
const GRID_LEFT = KEY_WIDTH + KEY_GAP;
const STRIP_GAP = 8;
const STEM_INSET = 2;
const { Quarter } = PPQN;
const EIGHTH = Quarter / 2;
const RAIL_LABELS = [71, 67, 64, 60];

/** One bar of the Melody: the eighth notes with the velocity ramp. */
const MELODY_BAR: readonly PatternNote[] = patternById("melody").notes.filter((note) => note.position < BAR_PPQN);

const flatNote = (position: number, duration: number, pitch: number): PatternNote => ({ position, duration, pitch, velocity: 1 });

interface Step {
  readonly heading: string;
  readonly text: string;
  /** What the drawing shows, for a screen reader. */
  readonly label: string;
  readonly notes: readonly PatternNote[];
  readonly stems: boolean;
}

const STEPS: readonly Step[] = [
  {
    heading: "1. A note is a bar",
    text: "It starts sounding at the bar's left edge and stops at its right edge.",
    label: "One bar in the middle of the roll, two beats long",
    notes: [flatNote(Quarter, 2 * Quarter, 64)],
    stems: false,
  },
  {
    heading: "2. Height is pitch",
    text: "Each row is one piano key. Up one row is one key higher.",
    label: "Four bars one after another, each on a higher row than the last",
    notes: [flatNote(0, Quarter, 60), flatNote(Quarter, Quarter, 64), flatNote(2 * Quarter, Quarter, 67), flatNote(3 * Quarter, Quarter, 69)],
    stems: false,
  },
  {
    heading: "3. Width is length",
    text: "A wider bar is held longer: the same key, for more time.",
    label: "Three bars on one row, each twice as wide as the last",
    notes: [flatNote(0, EIGHTH, 64), flatNote(EIGHTH, Quarter, 64), flatNote(EIGHTH + Quarter, 2 * Quarter, 64)],
    stems: false,
  },
  {
    heading: "4. Brightness is velocity",
    text: "How hard the key was hit. The stem underneath shows the same value as a height.",
    label: "Eight notes getting brighter from left to right, with a taller stem under each",
    notes: MELODY_BAR,
    stems: true,
  },
];

interface RollGeometry {
  readonly rowHeight: number;
  readonly quarterWidth: number;
  readonly stripHeight: number;
}

const STEP_GEOMETRY: RollGeometry = { rowHeight: 7, quarterWidth: 30, stripHeight: 26 };
const DATA_GEOMETRY: RollGeometry = { rowHeight: 14, quarterWidth: 80, stripHeight: 40 };

const rollHeight = ({ rowHeight, stripHeight }: RollGeometry) => ROWS * rowHeight + STRIP_GAP + stripHeight;

const Roll: React.FC<{
  label: string;
  notes: readonly PatternNote[];
  stems: boolean;
  geometry: RollGeometry;
  activeIndex?: number;
  onActivate?: (index: number) => void;
}> = ({ label, notes, stems, geometry, activeIndex, onActivate }) => {
  const { rowHeight, quarterWidth, stripHeight } = geometry;
  const gridHeight = ROWS * rowHeight;
  const gridWidth = (BAR_PPQN / Quarter) * quarterWidth;
  const x = (ppqn: number) => GRID_LEFT + (ppqn / Quarter) * quarterWidth;
  const rowTop = (pitch: number) => (HIGH_PITCH - pitch) * rowHeight;
  const stripBottom = rollHeight(geometry);

  const pitches = Array.from({ length: ROWS }, (_, row) => HIGH_PITCH - row);
  const gridLines = Array.from({ length: BAR_PPQN / EIGHTH + 1 }, (_, line) => line * EIGHTH);
  // A white key meets the next one on the row line (E-F, B-C), or under the middle of the black key between them.
  const whiteKeyEdges = pitches
    .filter((pitch) => pitch < HIGH_PITCH && !MidiKeys.isBlackKey(pitch))
    .map((pitch) => (MidiKeys.isBlackKey(pitch + 1) ? rowTop(pitch + 1) + rowHeight / 2 : rowTop(pitch)));

  return (
    <svg className="prx-svg" viewBox={`0 0 ${GRID_LEFT + gridWidth} ${stripBottom}`} role="img" aria-label={label}>
      {pitches.map((pitch) => (
        <rect
          key={pitch}
          x={GRID_LEFT}
          y={rowTop(pitch)}
          width={gridWidth}
          height={rowHeight}
          fill={MidiKeys.isBlackKey(pitch) ? "var(--mc-bg)" : "var(--mc-shade)"}
        />
      ))}
      <rect data-white-keys x={0} y={0} width={KEY_WIDTH} height={gridHeight} fill="var(--mc-text)" />
      {whiteKeyEdges.map((y) => (
        <line key={y} data-key-edge x1={0} x2={KEY_WIDTH} y1={y} y2={y} stroke="var(--mc-faint)" strokeWidth={0.75} />
      ))}
      {pitches.filter(MidiKeys.isBlackKey).map((pitch) => (
        <rect key={pitch} data-black-key={pitch} x={0} y={rowTop(pitch)} width={BLACK_KEY_WIDTH} height={rowHeight} fill="var(--mc-bg)" />
      ))}
      {gridLines.map((ppqn) => (
        <line
          key={ppqn}
          x1={x(ppqn)}
          x2={x(ppqn)}
          y1={0}
          y2={gridHeight}
          stroke={ppqn % Quarter === 0 ? "var(--mc-faint)" : "var(--mc-line-bright)"}
        />
      ))}
      {notes.map((note, index) => (
        <rect
          key={index}
          data-note={index}
          x={x(note.position) + 1}
          y={rowTop(note.pitch) + 1}
          width={(note.duration / Quarter) * quarterWidth - 2}
          height={rowHeight - 2}
          rx={1}
          fill={velocityColor(note.velocity)}
          stroke={activeIndex === index ? "var(--mc-text)" : undefined}
          strokeWidth={activeIndex === index ? 1.5 : undefined}
          onMouseEnter={onActivate === undefined ? undefined : () => onActivate(index)}
          onClick={onActivate === undefined ? undefined : () => onActivate(index)}
        />
      ))}
      {stems && <rect x={GRID_LEFT} y={gridHeight + STRIP_GAP} width={gridWidth} height={stripHeight} fill="var(--mc-shade)" />}
      {stems &&
        notes.map((note, index) => {
          const stemX = x(note.position) + STEM_INSET;
          const top = stripBottom - stripHeight * note.velocity;
          const color = velocityColor(note.velocity);
          return (
            <g key={index}>
              <line data-stem={index} x1={stemX} x2={stemX} y1={stripBottom} y2={top} stroke={color} strokeWidth={2} />
              <circle cx={stemX} cy={top} r={2.5} fill={color} />
            </g>
          );
        })}
    </svg>
  );
};

export const PianoRollSteps: React.FC = () => (
  <div className="prx-steps">
    {STEPS.map((step) => (
      <div className="prx-step" data-step key={step.heading}>
        <h3 className="prx-step-head">{step.heading}</h3>
        <Roll label={step.label} notes={step.notes} stems={step.stems} geometry={STEP_GEOMETRY} />
        <p className="prx-step-text">{step.text}</p>
      </div>
    ))}
  </div>
);

/** Four notes, played hard, so what each effect does to them is plain. */
const CHAIN_NOTES: readonly PatternNote[] = [60, 62, 64, 65].map((pitch, index) => ({
  position: index * Quarter,
  duration: Quarter,
  pitch,
  velocity: 0.9,
}));
const CHAIN_SEMITONES = 5;
const CHAIN_SOFTER_BY = 0.45;
const AFTER_PITCH = CHAIN_NOTES.map((note) => ({ ...note, pitch: note.pitch + CHAIN_SEMITONES }));
const AFTER_VELOCITY = AFTER_PITCH.map((note) => ({ ...note, velocity: note.velocity - CHAIN_SOFTER_BY }));

const ROLL_WIDTH = GRID_LEFT + (BAR_PPQN / Quarter) * STEP_GEOMETRY.quarterWidth;
const ROLL_HEIGHT = rollHeight(STEP_GEOMETRY);

/** The instrument's end of the chain: a tone drawn in the space a roll takes, so the panels line up. */
const SoundWave: React.FC = () => {
  const middle = ROLL_HEIGHT / 2;
  const points = Array.from({ length: ROLL_WIDTH + 1 }, (_, x) => {
    const envelope = Math.sin((Math.PI * x) / ROLL_WIDTH);
    return `${x},${(middle - Math.sin(x / 2.2) * envelope * (middle - 8)).toFixed(1)}`;
  });
  return (
    <svg className="prx-svg" viewBox={`0 0 ${ROLL_WIDTH} ${ROLL_HEIGHT}`} role="img" aria-label="A sound wave">
      <polyline data-sound points={points.join(" ")} fill="none" stroke="var(--mc-amber)" strokeWidth={1.5} />
    </svg>
  );
};

const CHAIN_STAGES: readonly { heading: string; text: string; label: string; notes?: readonly PatternNote[] }[] = [
  { heading: "Notes", text: "Four notes, as they were written.", label: "Four rising notes, played hard", notes: CHAIN_NOTES },
  { heading: "Pitch", text: "Set to +5: every bar moves up five rows.", label: "The same four notes, five keys higher", notes: AFTER_PITCH },
  { heading: "Velocity", text: "Set softer: the same bars, dimmer, with shorter stems.", label: "The same four notes, five keys higher and softer", notes: AFTER_VELOCITY },
  { heading: "Instrument", text: "Turns whatever reaches it into sound.", label: "" },
];

export const EffectChainDiagram: React.FC = () => (
  <div>
    <div className="prx-chain">
      {CHAIN_STAGES.map((stage, index) => (
        <div className="prx-chain-part" key={stage.heading}>
          {index > 0 && <span className="prx-chain-arrow" aria-hidden="true">&rarr;</span>}
          <div className="prx-step" data-stage>
            <h3 className="prx-step-head prx-chain-head">{stage.heading}</h3>
            {stage.notes === undefined ? <SoundWave /> : <Roll label={stage.label} notes={stage.notes} stems geometry={STEP_GEOMETRY} />}
            <p className="prx-step-text">{stage.text}</p>
          </div>
        </div>
      ))}
    </div>
    <p className="prx-chain-pull">
      <span className="prx-chain-pull-arrow" aria-hidden="true">&larr;</span> The asking runs the other way. The
      instrument asks Velocity for notes, Velocity asks Pitch, and Pitch reads the region. Each one changes what it
      gets back and hands it on.
    </p>
  </div>
);

/** One field of a note object, its value padded so the columns line up in the mono face. Never breaks across lines. */
const Field: React.FC<{ name: string; value: string | number; width?: number }> = ({ name, value, width = 0 }) => (
  <span className="prx-field">
    {name}: <span className="prx-value">{String(value).padStart(width, " ")}</span>
  </span>
);

/** The note the page opens with lit, so the link shows before anyone touches it. */
const INITIAL_NOTE = 3;

export const NoteDataLink: React.FC = () => {
  const [active, setActive] = useState(INITIAL_NOTE);
  return (
    <div className="prx-link">
      <div className="prx-rows">
        {MELODY_BAR.map((note, index) => (
          <button
            type="button"
            className="prx-row"
            key={index}
            aria-current={active === index ? "true" : undefined}
            onMouseEnter={() => setActive(index)}
            onFocus={() => setActive(index)}
            onClick={() => setActive(index)}
          >
            {"{ "}
            <Field name="position" value={note.position} width={4} />
            {", "}
            <Field name="duration" value={note.duration} />
            {", "}
            <Field name="pitch" value={note.pitch} />
            {", "}
            <Field name="velocity" value={note.velocity.toFixed(2)} />
            {" }"}
          </button>
        ))}
      </div>
      <div className="prx-roll">
        <div className="prx-rail" aria-hidden="true">
          {RAIL_LABELS.map((pitch) => (
            <span
              key={pitch}
              style={{ top: `${(((HIGH_PITCH - pitch + 0.5) * DATA_GEOMETRY.rowHeight) / rollHeight(DATA_GEOMETRY)) * 100}%` }}
            >
              {pitch}
            </span>
          ))}
        </div>
        <Roll
          label="The same eight notes as bars, each lit together with its line of data"
          notes={MELODY_BAR}
          stems
          geometry={DATA_GEOMETRY}
          activeIndex={active}
          onActivate={setActive}
        />
      </div>
    </div>
  );
};

export const PIANO_ROLL_STYLES = `
.prx-svg { display: block; width: 100%; height: auto; }
.prx-steps {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1px;
  background: var(--mc-line);
  border: 1px solid var(--mc-line);
  border-radius: 4px;
  overflow: hidden;
  margin-top: 16px;
}
.prx-step { background: var(--mc-bg); padding: 14px; }
.prx-step-head {
  font-family: var(--mc-mono);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.35;
  min-height: 2.7em;
  color: var(--mc-text);
  margin: 0 0 10px;
}
.mc-anchors .prx-step-text { font-size: 12.5px; line-height: 1.5; margin: 10px 0 0; }
.prx-link {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 20px;
  align-items: start;
  margin-top: 16px;
}
.prx-rows { min-width: 0; overflow-x: auto; }
.prx-row {
  display: block;
  width: 100%;
  min-width: max-content;
  background: none;
  border: 0;
  border-left: 2px solid transparent;
  padding: 7px 8px;
  font-family: var(--mc-mono);
  font-size: 11.5px;
  line-height: 1;
  white-space: pre;
  text-align: left;
  color: var(--mc-muted);
  cursor: default;
}
.prx-row[aria-current="true"] { background: var(--mc-shade); border-left-color: var(--mc-amber); color: var(--mc-text); }
.prx-row:focus-visible { outline: 2px solid var(--mc-amber); outline-offset: -2px; }
.prx-field { white-space: pre; }
.prx-value { color: var(--mc-amber); }
.prx-roll { display: grid; grid-template-columns: 24px minmax(0, 1fr); min-width: 0; }
.prx-rail { position: relative; }
.prx-rail span {
  position: absolute;
  right: 6px;
  transform: translateY(-50%);
  font-family: var(--mc-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--mc-label);
}
.prx-names {
  display: grid;
  grid-template-columns: 72px 1fr;
  max-width: 72ch;
  margin-top: 14px;
  border: 1px solid var(--mc-line);
  border-radius: 4px;
  font-size: 13px;
  line-height: 1.5;
}
.prx-names dt, .prx-names dd { margin: 0; padding: 8px 12px; border-bottom: 1px solid var(--mc-line); }
.prx-names dt:nth-last-of-type(1), .prx-names dd:nth-last-of-type(1) { border-bottom: 0; }
.prx-names dt { font-family: var(--mc-mono); color: var(--mc-amber); }
.prx-names dd { color: var(--mc-muted); }
.mc-anchors .prx-code {
  display: block;
  max-width: 72ch;
  margin-top: 12px;
  padding: 12px 14px;
  white-space: pre-wrap;
  font-family: var(--mc-mono);
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--mc-text);
  background: var(--mc-bg);
  border: 1px solid var(--mc-line);
  border-radius: 3px;
}
.prx-code-note { color: var(--mc-label); }
.prx-chain { display: flex; align-items: stretch; margin-top: 16px; }
.prx-chain-part { display: flex; align-items: center; flex: 1 1 0; min-width: 0; }
.prx-chain-part:first-child { flex-grow: 0.92; }
.prx-chain-part .prx-step {
  flex: 1 1 0;
  min-width: 0;
  align-self: stretch;
  padding: 10px;
  border: 1px solid var(--mc-line);
  border-radius: 4px;
}
.prx-chain-head { min-height: 0; }
.prx-chain-arrow {
  flex: none;
  width: 22px;
  text-align: center;
  font-family: var(--mc-mono);
  font-size: 14px;
  color: var(--mc-amber);
}
.mc-anchors .prx-chain-pull { max-width: none; font-size: 12.5px; line-height: 1.5; margin-top: 10px; }
.prx-chain-pull-arrow { font-family: var(--mc-mono); color: var(--mc-amber); }
.prx-effects { list-style: none; max-width: 72ch; margin: 12px 0 0; padding: 0; font-size: 13.5px; }
.prx-effects li {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  column-gap: 16px;
  line-height: 1.5;
  color: var(--mc-muted);
  padding: 6px 0;
  border-bottom: 1px solid var(--mc-line);
}
.prx-effects li:last-child { border-bottom: 0; }
.prx-effects strong { color: var(--mc-text); font-weight: 600; }
@media (max-width: 880px) {
  .prx-steps { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .prx-link { grid-template-columns: minmax(0, 1fr); }
  .prx-chain { flex-direction: column; }
  .prx-chain-part { flex-direction: column; flex: none; }
  .prx-chain-part .prx-step { flex: none; width: 100%; box-sizing: border-box; max-width: 320px; }
  .prx-chain-arrow { transform: rotate(90deg); padding: 6px 0; }
  .prx-chain-pull-arrow { display: inline-block; transform: rotate(90deg); }
}
@media (max-width: 480px) {
  .prx-steps { grid-template-columns: minmax(0, 1fr); }
  .prx-row { white-space: normal; min-width: 0; line-height: 1.5; }
}
`;
