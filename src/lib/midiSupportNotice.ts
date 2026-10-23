/**
 * What a demo that offers hardware MIDI tells the visitor about their browser. The
 * register of the facts is docs/known-vendor-issues.md (WebKit 107250, Firefox 1798742,
 * 1802149 and 1742635): Safari has no Web MIDI; Firefox lists only the devices present
 * when it started and asks for a site-permission add-on on the first request.
 */
export type MidiNoticeKind = "no-web-midi" | "firefox" | "denied";
export type MidiNoticeColor = "gray" | "blue" | "red";

export interface MidiSupportNotice {
  readonly kind: MidiNoticeKind;
  readonly color: MidiNoticeColor;
  readonly text: string;
}

export interface MidiSupportState {
  /** `MidiDevices.canRequestMidiAccess()` — whether `requestMIDIAccess` exists. */
  readonly canRequestMidi: boolean;
  readonly userAgent: string;
  /** A request was made and the browser or the visitor refused it. */
  readonly denied: boolean;
}

export const isFirefox = (userAgent: string): boolean => /\bFirefox\/\d/.test(userAgent);

export const NO_WEB_MIDI_TEXT =
  "This browser has no Web MIDI, so hardware MIDI devices cannot be used. The on-screen keyboard works.";

export const FIREFOX_TEXT =
  "Firefox lists only the MIDI devices that were present when it started: plug in your device, then " +
  "restart Firefox. The first request installs a site permission add-on.";

export const DENIED_TEXT =
  "MIDI access was denied, so hardware MIDI devices are unavailable. The on-screen keyboard still works.";

/** The notices for the info area, in display order. Empty when nothing stands in the way. */
export function midiSupportNotices({ canRequestMidi, userAgent, denied }: MidiSupportState): MidiSupportNotice[] {
  if (!canRequestMidi) return [{ kind: "no-web-midi", color: "gray", text: NO_WEB_MIDI_TEXT }];
  const notices: MidiSupportNotice[] = [];
  if (denied) notices.push({ kind: "denied", color: "red", text: DENIED_TEXT });
  if (isFirefox(userAgent)) notices.push({ kind: "firefox", color: "blue", text: FIREFOX_TEXT });
  return notices;
}
