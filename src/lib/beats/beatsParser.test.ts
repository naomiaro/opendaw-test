// src/lib/beats/beatsParser.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { resolve } from "path";
import { parseBeatsFile } from "./beatsParser";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const VALID = `# comment line
1.260000\t4

1.800000\t1
2.320000\t2
`;

describe("parseBeatsFile", () => {
  it("parses rows, skipping comments and blank lines", () => {
    const markers = parseBeatsFile(VALID);
    expect(markers).toEqual([
      { second: 1.26, beatInBar: 4 },
      { second: 1.8, beatInBar: 1 },
      { second: 2.32, beatInBar: 2 },
    ]);
  });

  it("accepts space-separated columns too", () => {
    expect(parseBeatsFile("0.5 1\n1.0 2\n")).toEqual([
      { second: 0.5, beatInBar: 1 },
      { second: 1.0, beatInBar: 2 },
    ]);
  });

  it("rejects rows with missing or non-numeric values", () => {
    expect(() => parseBeatsFile("0.5 1\nbogus row\n")).toThrow(/line 2/i);
    expect(() => parseBeatsFile("0.5 1\n1.0 2 9\n")).toThrow(/line 2/i);
  });

  it("rejects negative seconds", () => {
    expect(() => parseBeatsFile("-0.5 1\n1.0 2\n")).toThrow(/non-negative/i);
  });

  it("rejects beatInBar < 1 or non-integer", () => {
    expect(() => parseBeatsFile("0.5 0\n1.0 1\n")).toThrow(/beatInBar/i);
    expect(() => parseBeatsFile("0.5 1.5\n1.0 2\n")).toThrow(/beatInBar/i);
  });

  it("rejects non-monotonic seconds (warp map needs an inverse)", () => {
    expect(() => parseBeatsFile("1.0 1\n0.9 2\n")).toThrow(/monotonic/i);
  });

  it("rejects fewer than 2 markers (no segment to derive tempo from)", () => {
    expect(() => parseBeatsFile("1.0 1\n")).toThrow(/at least 2/i);
  });

  it("parses the real bundled Otherside beat map", () => {
    const text = readFileSync(
      resolve(__dirname, "../../../public/audio/Otherside.beats"),
      "utf-8"
    );
    const markers = parseBeatsFile(text);
    expect(markers).toHaveLength(511);
    expect(markers[0]).toEqual({ second: 1.26, beatInBar: 4 });
    expect(markers[markers.length - 1].second).toBeCloseTo(249.26, 5);
  });
});
