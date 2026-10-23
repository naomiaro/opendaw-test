import { describe, expect, it } from "vitest";
import { isFirefox, midiSupportNotices } from "./midiSupportNotice";

const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";
const FIREFOX_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 15.6; rv:148.0) Gecko/20100101 Firefox/148.0";
const SAFARI_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";

describe("isFirefox", () => {
  it("recognises a Firefox user agent", () => {
    expect(isFirefox(FIREFOX_UA)).toBe(true);
  });
  it("does not take Chrome or Safari for Firefox", () => {
    expect(isFirefox(CHROME_UA)).toBe(false);
    expect(isFirefox(SAFARI_UA)).toBe(false);
  });
  it("wants the version after the name, not the bare word", () => {
    expect(isFirefox(CHROME_UA + " Firefox")).toBe(false);
  });
});

describe("midiSupportNotices", () => {
  it("is empty in a browser with Web MIDI and no refusal", () => {
    expect(midiSupportNotices({ canRequestMidi: true, userAgent: CHROME_UA, denied: false })).toEqual([]);
  });

  it("names the missing Web MIDI and the working keyboard when the browser has none", () => {
    const notices = midiSupportNotices({ canRequestMidi: false, userAgent: SAFARI_UA, denied: false });
    expect(notices).toHaveLength(1);
    expect(notices[0].kind).toBe("no-web-midi");
    expect(notices[0].text).toMatch(/no Web MIDI/);
    expect(notices[0].text).toMatch(/on-screen keyboard works/);
  });

  it("tells a Firefox visitor about the fixed device list and the add-on prompt from load", () => {
    const notices = midiSupportNotices({ canRequestMidi: true, userAgent: FIREFOX_UA, denied: false });
    expect(notices).toHaveLength(1);
    expect(notices[0].kind).toBe("firefox");
    expect(notices[0].text).toMatch(/restart Firefox/);
    expect(notices[0].text).toMatch(/add-on/);
  });

  it("reports a refused request in any browser", () => {
    const notices = midiSupportNotices({ canRequestMidi: true, userAgent: CHROME_UA, denied: true });
    expect(notices.map((n) => n.kind)).toEqual(["denied"]);
    expect(notices[0].text).toMatch(/denied/);
  });

  it("says only that there is no Web MIDI, whatever else is true", () => {
    const notices = midiSupportNotices({ canRequestMidi: false, userAgent: FIREFOX_UA, denied: true });
    expect(notices.map((n) => n.kind)).toEqual(["no-web-midi"]);
  });

  it("keeps the Firefox notice next to a refusal, refusal first", () => {
    const notices = midiSupportNotices({ canRequestMidi: true, userAgent: FIREFOX_UA, denied: true });
    expect(notices.map((n) => n.kind)).toEqual(["denied", "firefox"]);
  });

  it("gives each kind the tone its colour carries", () => {
    const colours = (args: Parameters<typeof midiSupportNotices>[0]) => midiSupportNotices(args).map((n) => n.color);
    expect(colours({ canRequestMidi: false, userAgent: SAFARI_UA, denied: false })).toEqual(["gray"]);
    expect(colours({ canRequestMidi: true, userAgent: FIREFOX_UA, denied: false })).toEqual(["blue"]);
    expect(colours({ canRequestMidi: true, userAgent: CHROME_UA, denied: true })).toEqual(["red"]);
  });
});
