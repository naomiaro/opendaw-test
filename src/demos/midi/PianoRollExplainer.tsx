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
  readonly notes: readonly PatternNote[];
  readonly stems: boolean;
}

const STEPS: readonly Step[] = [
  {
    heading: "1. A note is a bar",
    text: "It starts sounding at the bar's left edge and stops at its right edge.",
    notes: [flatNote(Quarter, 2 * Quarter, 64)],
    stems: false,
  },
  {
    heading: "2. Height is pitch",
    text: "Each row is one piano key. Up one row is one key higher.",
    notes: [flatNote(0, Quarter, 60), flatNote(Quarter, Quarter, 64), flatNote(2 * Quarter, Quarter, 67), flatNote(3 * Quarter, Quarter, 69)],
    stems: false,
  },
  {
    heading: "3. Width is length",
    text: "A wider bar is held longer: the same key, for more time.",
    notes: [flatNote(0, EIGHTH, 64), flatNote(EIGHTH, Quarter, 64), flatNote(EIGHTH + Quarter, 2 * Quarter, 64)],
    stems: false,
  },
  {
    heading: "4. Brightness is velocity",
    text: "How hard the key was hit. The stem underneath shows the same value as a height.",
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

  return (
    <svg className="prx-svg" viewBox={`0 0 ${GRID_LEFT + gridWidth} ${stripBottom}`} role="img" aria-label={label}>
      {pitches.map((pitch) => {
        const black = MidiKeys.isBlackKey(pitch);
        return (
          <g key={pitch}>
            <rect x={GRID_LEFT} y={rowTop(pitch)} width={gridWidth} height={rowHeight} fill={black ? "var(--mc-bg)" : "var(--mc-shade)"} />
            <rect x={0} y={rowTop(pitch) + 0.5} width={KEY_WIDTH} height={rowHeight - 1} fill={black ? "var(--mc-line-bright)" : "var(--mc-text)"} />
          </g>
        );
      })}
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
          data-active={activeIndex === index ? "true" : undefined}
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
      {stems && <rect x={GRID_LEFT} y={gridHeight + STRIP_GAP} width={gridWidth} height={stripHeight} fill="var(--mc-panel)" />}
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
        <Roll label={step.heading} notes={step.notes} stems={step.stems} geometry={STEP_GEOMETRY} />
        <p className="prx-step-text">{step.text}</p>
      </div>
    ))}
  </div>
);

/** A value in a note object, padded so the columns line up in the mono face. */
const Value: React.FC<{ value: string | number; width?: number }> = ({ value, width = 0 }) => (
  <span className="prx-value">{String(value).padStart(width, " ")}</span>
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
            aria-pressed={active === index}
            onMouseEnter={() => setActive(index)}
            onFocus={() => setActive(index)}
          >
            {"{ position: "}
            <Value value={note.position} width={4} />
            {", duration: "}
            <Value value={note.duration} />
            {", pitch: "}
            <Value value={note.pitch} />
            {", velocity: "}
            <Value value={note.velocity.toFixed(2)} />
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
.prx-row[aria-pressed="true"] { background: var(--mc-shade); border-left-color: var(--mc-amber); color: var(--mc-text); }
.prx-row:focus-visible { outline: 2px solid var(--mc-amber); outline-offset: -2px; }
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
.prx-code {
  display: block;
  max-width: 72ch;
  margin-top: 12px;
  padding: 12px 14px;
  overflow-x: auto;
  white-space: pre;
  font-family: var(--mc-mono);
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--mc-text);
  background: var(--mc-bg);
  border: 1px solid var(--mc-line);
  border-radius: 3px;
}
.prx-code-note { color: var(--mc-label); }
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
}
@media (max-width: 480px) {
  .prx-steps { grid-template-columns: minmax(0, 1fr); }
}
`;
