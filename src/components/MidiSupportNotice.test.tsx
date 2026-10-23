import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Theme } from "@radix-ui/themes";
import { MidiSupportNotice } from "./MidiSupportNotice";
import { DENIED_TEXT, FIREFOX_TEXT, NO_WEB_MIDI_TEXT } from "@/lib/midiSupportNotice";

// Rendered to markup on the server: what the info area shows for a given state.
const render = (element: React.ReactElement): string => renderToStaticMarkup(<Theme>{element}</Theme>);

const FIREFOX_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 15.6; rv:148.0) Gecko/20100101 Firefox/148.0";
const CHROME_UA = "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";

describe("MidiSupportNotice", () => {
  it("renders nothing when the browser has Web MIDI and nothing was refused", () => {
    expect(renderToStaticMarkup(<MidiSupportNotice canRequestMidi userAgent={CHROME_UA} denied={false} />)).toBe("");
  });

  it("shows the no-Web-MIDI text as a status, not an alert", () => {
    const markup = render(<MidiSupportNotice canRequestMidi={false} userAgent={CHROME_UA} denied={false} />);
    expect(markup).toContain(NO_WEB_MIDI_TEXT);
    expect(markup).toMatch(/role="status"/);
    expect(markup).not.toMatch(/role="alert"/);
  });

  it("shows the Firefox note as a status, not an alert", () => {
    const markup = render(<MidiSupportNotice canRequestMidi userAgent={FIREFOX_UA} denied={false} />);
    expect(markup).toContain(FIREFOX_TEXT);
    expect(markup).toMatch(/data-accent-color="blue"[^>]*role="status"/);
    expect(markup).not.toMatch(/role="alert"/);
  });

  it("shows a refusal as a red alert above the Firefox note", () => {
    const markup = render(<MidiSupportNotice canRequestMidi userAgent={FIREFOX_UA} denied />);
    expect(markup).toMatch(/data-accent-color="red"[^>]*role="alert"/);
    expect(markup.match(/role="alert"/g)).toHaveLength(1);
    expect(markup.indexOf(DENIED_TEXT)).toBeGreaterThan(-1);
    expect(markup.indexOf(DENIED_TEXT)).toBeLessThan(markup.indexOf(FIREFOX_TEXT));
  });
});
