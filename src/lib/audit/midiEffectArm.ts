/**
 * The MIDI effect arm of the MIDI input alignment sweep (`&effect=`): a device inserted on the recorded
 * unit. Kept free of SDK imports so the summary parser, and the Node table script through it, can
 * import it as a value.
 */
export const MIDI_EFFECT_ARMS = ["none", "pitch", "arpeggio"] as const;
export type MidiEffectArm = (typeof MIDI_EFFECT_ARMS)[number];

export function isMidiEffectArm(value: string): value is MidiEffectArm {
  return (MIDI_EFFECT_ARMS as readonly string[]).includes(value);
}
