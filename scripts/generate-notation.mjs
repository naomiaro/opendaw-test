// Extracts Bravura.woff2 from VexFlow's bundled data URL into
// documentation/public/fonts/Bravura.woff2. Run once after a vexflow
// upgrade or whenever the font file is missing:
//
//   node scripts/generate-notation.mjs
//
// SVG rendering is NOT done here. VexFlow 5 relies on the browser's font
// metrics for glyph positioning; rendering in Node + JSDOM produces
// subtly broken output (empty noteheads, misaligned flags). Instead, the
// canonical engravings are produced by a browser-side harness:
//
//   1. Start the docs dev server: npm run docs:dev
//   2. Open http://localhost:5174/docs/_render-notation.html (port may
//      vary). The harness loads VexFlow from unpkg, registers Bravura
//      via FontFace, and renders each engraving into a labelled <div>.
//   3. Extract the rendered <svg> outerHTML for each note id and save
//      to documentation/public/notation/<id>.svg.
//   4. Run: node scripts/inline-notation-svgs.mjs documentation/01-introduction.md
//
// Step 3 can be done via the Playwright MCP tool's evaluate function or
// by copy-paste from the harness page's DOM inspector.

import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fontsDir = join(__dirname, "..", "documentation", "public", "fonts");
mkdirSync(fontsDir, { recursive: true });

const bravuraSrc = readFileSync(
  join(
    __dirname,
    "..",
    "node_modules",
    "vexflow",
    "build",
    "esm",
    "src",
    "fonts",
    "bravura.js"
  ),
  "utf-8"
);
const dataUrlPrefix = "data:font/woff2;charset=utf-8;base64,";
const start = bravuraSrc.indexOf(dataUrlPrefix);
const end = bravuraSrc.indexOf("'", start + dataUrlPrefix.length);
if (start < 0 || end < 0) {
  throw new Error("Could not extract Bravura woff2 from vexflow's bravura.js");
}
const base64 = bravuraSrc.slice(start + dataUrlPrefix.length, end);
const woff2 = Buffer.from(base64, "base64");
writeFileSync(join(fontsDir, "Bravura.woff2"), woff2);
console.log(`wrote Bravura.woff2 (${woff2.byteLength} bytes)`);
console.log(
  "To regenerate the notation SVGs, see the comment at the top of this script."
);
