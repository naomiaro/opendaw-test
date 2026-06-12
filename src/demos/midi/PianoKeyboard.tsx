import React from "react";
import { Text } from "@radix-ui/themes";

// Piano key layout constants
const WHITE_KEYS = [0, 2, 4, 5, 7, 9, 11]; // C, D, E, F, G, A, B semitone offsets
const BLACK_KEY_OFFSETS = [1, 3, 6, 8, 10]; // C#, D#, F#, G#, A# semitone offsets
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export const noteName = (pitch: number) => `${NOTE_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`;

// Octave range for the on-screen keyboard
const KEYBOARD_START_OCTAVE = 3; // C3
const KEYBOARD_OCTAVES = 3; // C3 to B5
const KEYBOARD_START_NOTE = KEYBOARD_START_OCTAVE * 12 + 12; // MIDI note 48 (C3)
const KEYBOARD_END_NOTE = KEYBOARD_START_NOTE + KEYBOARD_OCTAVES * 12; // MIDI note 84 (C6)

// Key caps draw from the console palette (consoleTheme.ts). The one literal is
// an amber-family value derived for the contrast floors: pressed vs unpressed
// >= 3:1, and key labels >= 4.5:1 in both states.
const KEY_COLORS = {
  whiteIdle: "var(--mc-text)", // #d8d2c8 key cap
  whiteActive: "#6b4410", // deep amber — 5.7:1 vs idle cap
  blackIdle: "var(--mc-shade)", // #221d15
  blackActive: "var(--mc-amber)", // 7.8:1 vs idle cap
  whiteBorder: "var(--mc-line-bright)",
  blackBorder: "var(--mc-bg)",
  labelIdle: "var(--mc-shade)", // 11.1:1 on the idle cap
  labelActive: "var(--mc-text)", // 5.7:1 on the active cap
} as const;

// Press transition is smoothing only — dropped under prefers-reduced-motion.
export const PIANO_STYLES = `
.pk-key { transition: background 0.05s; }
@media (prefers-reduced-motion: reduce) {
  .pk-key { transition: none; }
}
`;

/**
 * PianoKeyboard component - on-screen MIDI keyboard
 */
export const PianoKeyboard: React.FC<{
  activeNotes: Set<number>;
  onNoteOn: (note: number) => void;
  onNoteOff: (note: number) => void;
  disabled?: boolean;
}> = ({ activeNotes, onNoteOn, onNoteOff, disabled }) => {
  const whiteKeyWidth = 36;
  const blackKeyWidth = 22;
  const whiteKeyHeight = 120;
  const blackKeyHeight = 75;

  // Build list of white keys in range
  const whiteKeys: number[] = [];
  for (let note = KEYBOARD_START_NOTE; note < KEYBOARD_END_NOTE; note++) {
    if (WHITE_KEYS.includes(note % 12)) {
      whiteKeys.push(note);
    }
  }

  const totalWidth = whiteKeys.length * whiteKeyWidth;

  // Map white key index for positioning
  const whiteKeyIndex = (note: number) => whiteKeys.indexOf(note);

  return (
    <div
      style={{
        position: "relative",
        width: totalWidth,
        height: whiteKeyHeight,
        userSelect: "none",
        margin: "0 auto",
      }}
    >
      {/* White keys */}
      {whiteKeys.map((note) => (
        <div
          key={note}
          className="pk-key"
          onMouseDown={() => !disabled && onNoteOn(note)}
          onMouseUp={() => !disabled && onNoteOff(note)}
          onMouseLeave={() => !disabled && activeNotes.has(note) && onNoteOff(note)}
          style={{
            position: "absolute",
            left: whiteKeyIndex(note) * whiteKeyWidth,
            top: 0,
            width: whiteKeyWidth - 1,
            height: whiteKeyHeight,
            background: activeNotes.has(note) ? KEY_COLORS.whiteActive : KEY_COLORS.whiteIdle,
            border: `1px solid ${KEY_COLORS.whiteBorder}`,
            borderRadius: "0 0 4px 4px",
            cursor: disabled ? "default" : "pointer",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            paddingBottom: 4,
          }}
        >
          {note % 12 === 0 && (
            <Text
              size="1"
              style={{
                color: activeNotes.has(note) ? KEY_COLORS.labelActive : KEY_COLORS.labelIdle,
                fontSize: 10,
                fontFamily: "var(--mc-mono)",
              }}
            >
              {noteName(note)}
            </Text>
          )}
        </div>
      ))}

      {/* Black keys */}
      {whiteKeys.map((note, i) => {
        const nextSemitone = note + 1;
        if (nextSemitone >= KEYBOARD_END_NOTE) return null;
        if (!BLACK_KEY_OFFSETS.includes(nextSemitone % 12)) return null;

        return (
          <div
            key={nextSemitone}
            className="pk-key"
            onMouseDown={() => !disabled && onNoteOn(nextSemitone)}
            onMouseUp={() => !disabled && onNoteOff(nextSemitone)}
            onMouseLeave={() => !disabled && activeNotes.has(nextSemitone) && onNoteOff(nextSemitone)}
            style={{
              position: "absolute",
              left: i * whiteKeyWidth + whiteKeyWidth - blackKeyWidth / 2,
              top: 0,
              width: blackKeyWidth,
              height: blackKeyHeight,
              background: activeNotes.has(nextSemitone) ? KEY_COLORS.blackActive : KEY_COLORS.blackIdle,
              border: `1px solid ${KEY_COLORS.blackBorder}`,
              borderRadius: "0 0 3px 3px",
              cursor: disabled ? "default" : "pointer",
              zIndex: 1,
            }}
          />
        );
      })}
    </div>
  );
};
