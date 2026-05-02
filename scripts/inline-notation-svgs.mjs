// Replaces <img src="/notation/{name}.svg" ...> with the inline contents of
// the corresponding SVG file. Inlining is required because SVGs loaded via
// <img> can't fetch external fonts — the @font-face declared in
// documentation/.vitepress/theme/style.css only applies when the SVG is
// inlined in the HTML document.
//
// Run after editing the markdown or after regenerating SVGs:
//   node scripts/inline-notation-svgs.mjs documentation/01-introduction.md

import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const notationDir = join(__dirname, "..", "documentation", "public", "notation");

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: node scripts/inline-notation-svgs.mjs <markdown-file>");
  process.exit(1);
}

let md = readFileSync(inputPath, "utf-8");

// Match <img src="/notation/NAME.svg" ... height="N" />, capturing the
// height attribute so we can apply it to the inline <svg> element.
const imgRe = /<img\s+src="\/notation\/([a-z-]+)\.svg"\s+alt="[^"]*"\s+height="(\d+)"\s*\/>/g;

let replacements = 0;
md = md.replace(imgRe, (match, name, height) => {
  const svgPath = join(notationDir, `${name}.svg`);
  let svg;
  try {
    svg = readFileSync(svgPath, "utf-8");
  } catch (err) {
    console.error(`Could not read ${svgPath}: ${err.message}`);
    return match;
  }

  // Override the SVG's intrinsic width/height with the requested display height
  // (preserve aspect via removing fixed width and setting height).
  const styled = svg
    .replace(/\swidth="\d+"/, "")
    .replace(/\sheight="\d+"/, ` height="${height}"`)
    .replace(/<svg\s/, `<svg aria-label="${name}" role="img" `);

  replacements++;
  return styled;
});

writeFileSync(inputPath, md, "utf-8");
console.log(`inlined ${replacements} notation SVG(s) in ${inputPath}`);
