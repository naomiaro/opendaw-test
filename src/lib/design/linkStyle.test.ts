import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONSOLE_STYLES } from "./consoleTheme";

const token = (name: string) => {
  const match = new RegExp(`--mc-${name}:\\s*(#[0-9a-f]{6})`).exec(CONSOLE_STYLES);
  if (match === null) throw new Error(`no --mc-${name} token`);
  return match[1];
};

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5]
    .map((start) => parseInt(hex.slice(start, start + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a: string, b: string) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return path.endsWith(".tsx") && !path.includes(".test.") ? [path] : [];
  });
}

describe("links in the console theme", () => {
  it("have a colour of their own, not the amber that marks highlights", () => {
    expect(token("link")).not.toBe(token("amber"));
    expect(token("link-hover")).not.toBe(token("amber"));
  });

  it.each(["link", "link-hover"])("--mc-%s clears the text contrast floor on every surface", (name) => {
    for (const surface of ["bg", "panel", "panel-hover", "shade"]) {
      expect(contrast(token(name), token(surface))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("are coloured and underlined by one rule that reaches every link in prose", () => {
    const rule = /a:not\(\[class\]\),\s*a\.rt-Link\s*\{([^}]*)\}/.exec(CONSOLE_STYLES);
    expect(rule).not.toBeNull();
    expect(rule![1]).toContain("color: var(--mc-link)");
    expect(rule![1]).toContain("text-decoration: underline");
  });

  it("are not switched back off by a section of the theme", () => {
    expect(CONSOLE_STYLES).not.toMatch(/\.mc-anchors a\s*\{/);
  });

  it("are never repainted amber or stripped of the underline on a page", () => {
    const offenders = sourceFiles("src").flatMap((path) => {
      const anchors = readFileSync(path, "utf8").match(/<a\b[^>]*?style=\{\{[^}]*\}\}/g) ?? [];
      return anchors.filter((anchor) => /mc-amber|textDecoration: "none"/.test(anchor)).map((anchor) => `${path}: ${anchor.slice(0, 60)}`);
    });
    expect(offenders).toEqual([]);
  });
});
