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

function loadSvg(name, height) {
  const svgPath = join(notationDir, `${name}.svg`);
  const svg = readFileSync(svgPath, "utf-8");
  // Override the SVG's intrinsic width/height with the requested display height
  // (preserve aspect via removing fixed width and setting height).
  return svg
    .replace(/\swidth="\d+"/, "")
    .replace(/\sheight="\d+"/, ` height="${height}"`)
    .replace(/<svg\s/, `<svg aria-label="${name}" role="img" `);
}

let replacements = 0;

// 1. Replace placeholder <img src="/notation/NAME.svg" alt="..." height="N" />
//    with the inline SVG content. Used the first time a section is added.
const imgRe = /<img\s+src="\/notation\/([a-z-]+)\.svg"\s+alt="[^"]*"\s+height="(\d+)"\s*\/>/g;
md = md.replace(imgRe, (match, name, height) => {
  try {
    replacements++;
    return loadSvg(name, height);
  } catch (err) {
    console.error(`Could not read ${name}.svg: ${err.message}`);
    return match;
  }
});

// 2. Refresh existing inline <svg aria-label="NAME" ...>...</svg> blocks
//    with the current SVG file contents. Used after regenerating notation
//    glyphs (e.g. tweaking VexFlow output) so markdown picks up the change
//    without manual edits. Preserves the existing height attribute.
const inlineRe = /<svg\s+aria-label="([a-z-]+)"[^>]*\sheight="(\d+)"[^>]*>[\s\S]*?<\/svg>/g;
md = md.replace(inlineRe, (match, name, height) => {
  try {
    replacements++;
    return loadSvg(name, height);
  } catch (err) {
    console.error(`Could not refresh inline ${name}.svg: ${err.message}`);
    return match;
  }
});

writeFileSync(inputPath, md, "utf-8");
console.log(`inlined ${replacements} notation SVG(s) in ${inputPath}`);
