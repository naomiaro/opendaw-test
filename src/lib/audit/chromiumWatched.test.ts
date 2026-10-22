import { describe, expect, it } from "vitest";
import { WATCHED_ISSUES, browserOf, envelopeName, issueFrom, newRunToken, runDate } from "./chromiumWatched";

describe("issueFrom", () => {
  it("reads a known issue from the query", () => {
    expect(issueFrom(new URLSearchParams("issue=bfcache"))).toBe("bfcache");
  });

  it("throws on an unknown value and names every known issue", () => {
    expect(() => issueFrom(new URLSearchParams("issue=nope"))).toThrow(WATCHED_ISSUES.join(", "));
  });

  it("throws when the query names no issue", () => {
    expect(() => issueFrom(new URLSearchParams(""))).toThrow(WATCHED_ISSUES.join(", "));
  });
});

describe("envelopeName", () => {
  it("names the envelope after the issue and the run token", () => {
    expect(envelopeName("opfs-usage", "abc")).toBe("chromium-opfs-usage-abc.json");
  });
});

describe("browserOf", () => {
  it("joins the brands when the browser reports them", () => {
    const nav = {
      userAgent: "Mozilla/5.0",
      userAgentData: { brands: [{ brand: "Google Chrome", version: "155" }, { brand: "Chromium", version: "155" }] },
    };
    expect(browserOf(nav)).toBe("Google Chrome 155, Chromium 155");
  });

  it("leaves out the made-up brand Chrome lists beside its real ones", () => {
    const nav = {
      userAgent: "Mozilla/5.0",
      userAgentData: {
        brands: [
          { brand: "Google Chrome", version: "155" },
          { brand: "Not A;Brand", version: "99" },
          { brand: "Chromium", version: "155" },
        ],
      },
    };
    expect(browserOf(nav)).toBe("Google Chrome 155, Chromium 155");
  });

  it("falls back to the user-agent string without brands", () => {
    expect(browserOf({ userAgent: "Mozilla/5.0 Firefox/157.0" })).toBe("Mozilla/5.0 Firefox/157.0");
  });
});

describe("newRunToken", () => {
  it("names a file the dev server's sink accepts", () => {
    const name = envelopeName("first-read", newRunToken());
    expect(name).toMatch(/^[a-z0-9-]+\.(wav|json)$/);
  });
});

describe("runDate", () => {
  it("is the ISO date of the run", () => {
    expect(runDate(new Date("2026-10-23T08:30:00Z"))).toBe("2026-10-23");
  });
});
