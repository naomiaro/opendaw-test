// Renders music-notation SVGs for the British/American note-name table
// in documentation/01-introduction.md. Run: node scripts/generate-notation.mjs
//
// Output:
//   documentation/public/notation/{semibreve,minim,crotchet,quaver,
//     semiquaver,demisemiquaver,hemidemisemiquaver}.svg
//   documentation/public/fonts/Bravura.woff2 (extracted once from VexFlow)
//
// Each SVG embeds an @font-face referencing /docs/fonts/Bravura.woff2 so it
// renders SMuFL glyphs correctly without depending on system fonts.

import { JSDOM } from "jsdom";
import { writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const docsDir = join(__dirname, "..", "documentation", "public");
const notationDir = join(docsDir, "notation");
const fontsDir = join(docsDir, "fonts");
mkdirSync(notationDir, { recursive: true });
mkdirSync(fontsDir, { recursive: true });

// 1. Extract Bravura woff2 from VexFlow's bundled data URL.
// VexFlow's package.json blocks subpath imports, so read the file directly.
import { readFileSync } from "fs";
const bravuraSrc = readFileSync(
  join(__dirname, "..", "node_modules", "vexflow", "build", "esm", "src", "fonts", "bravura.js"),
  "utf-8"
);
const dataUrlPrefix = "data:font/woff2;charset=utf-8;base64,";
const start = bravuraSrc.indexOf(dataUrlPrefix);
const end = bravuraSrc.indexOf("'", start + dataUrlPrefix.length);
if (start < 0 || end < 0) {
  throw new Error("Could not extract Bravura woff2 from bravura.js");
}
const base64 = bravuraSrc.slice(start + dataUrlPrefix.length, end);
const woff2 = Buffer.from(base64, "base64");
writeFileSync(join(fontsDir, "Bravura.woff2"), woff2);
console.log(`wrote Bravura.woff2 (${woff2.byteLength} bytes)`);

// 2. Set up a JSDOM window for VexFlow's SVG renderer
const dom = new JSDOM(`<!DOCTYPE html><html><body></body></html>`);
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;

const VF = await import("vexflow");
const { Renderer, Stave, StaveNote, Voice, Formatter, Beam, Tuplet, Dot } = VF;

// 3. Render each note duration as its own SVG
const notes = [
  { name: "semibreve", duration: "w" },
  { name: "minim", duration: "h" },
  { name: "crotchet", duration: "q" },
  { name: "quaver", duration: "8" },
  { name: "semiquaver", duration: "16" },
  { name: "demisemiquaver", duration: "32" },
  { name: "hemidemisemiquaver", duration: "64" },
];

// SVGs are inlined in markdown and inherit Bravura from the page-level
// @font-face declared in documentation/.vitepress/theme/style.css.
// (Embedding @font-face inside the SVG only works when the SVG is rendered
// inline in HTML; SVGs loaded via <img> can't fetch external resources.)

function renderToSvg(width, height, drawFn) {
  const div = document.createElement("div");
  document.body.appendChild(div);
  const renderer = new Renderer(div, Renderer.Backends.SVG);
  renderer.resize(width, height);
  const ctx = renderer.getContext();
  const stave = new Stave(0, 0, width);
  stave.setContext(ctx).draw();
  drawFn(ctx, stave);
  const svgEl = ctx.getSVGElement
    ? ctx.getSVGElement()
    : div.querySelector("svg");
  svgEl.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const out = svgEl.outerHTML;
  document.body.removeChild(div);
  return out;
}

for (const note of notes) {
  const svgString = renderToSvg(80, 100, (ctx, stave) => {
    const staveNote = new StaveNote({
      keys: ["b/4"],
      duration: note.duration,
      auto_stem: true,
    });
    const voice = new Voice({ num_beats: 4, beat_value: 4 });
    voice.setStrict(false);
    voice.addTickable(staveNote);
    new Formatter().joinVoices([voice]).format([voice], 80 - 30);
    voice.draw(ctx, stave);
  });

  const filename = join(notationDir, `${note.name}.svg`);
  writeFileSync(filename, svgString, "utf-8");
  console.log(`wrote ${note.name}.svg (${Buffer.byteLength(svgString)} bytes)`);
}

// Dotted quaver — eighth note with augmentation dot (1.5× duration)
const dottedQuaverSvg = renderToSvg(80, 100, (ctx, stave) => {
  const note = new StaveNote({
    keys: ["b/4"],
    duration: "8d",
    auto_stem: true,
  });
  Dot.buildAndAttach([note], { all: true });
  const voice = new Voice({ num_beats: 4, beat_value: 4 });
  voice.setStrict(false);
  voice.addTickable(note);
  new Formatter().joinVoices([voice]).format([voice], 80 - 40);
  voice.draw(ctx, stave);
});
writeFileSync(join(notationDir, "dotted-quaver.svg"), dottedQuaverSvg, "utf-8");
console.log(`wrote dotted-quaver.svg (${Buffer.byteLength(dottedQuaverSvg)} bytes)`);

// Eighth-note triplet — three quavers beamed together with a "3" bracket above
const tripletSvg = renderToSvg(140, 100, (ctx, stave) => {
  const tripletNotes = [
    new StaveNote({ keys: ["b/4"], duration: "8", auto_stem: true }),
    new StaveNote({ keys: ["b/4"], duration: "8", auto_stem: true }),
    new StaveNote({ keys: ["b/4"], duration: "8", auto_stem: true }),
  ];
  const voice = new Voice({ num_beats: 4, beat_value: 4 });
  voice.setStrict(false);
  tripletNotes.forEach((n) => voice.addTickable(n));
  new Formatter().joinVoices([voice]).format([voice], 140 - 40);
  const beam = new Beam(tripletNotes);
  const tuplet = new Tuplet(tripletNotes);
  voice.draw(ctx, stave);
  beam.setContext(ctx).draw();
  tuplet.setContext(ctx).draw();
});
writeFileSync(join(notationDir, "triplet.svg"), tripletSvg, "utf-8");
console.log(`wrote triplet.svg (${Buffer.byteLength(tripletSvg)} bytes)`);

console.log("done");
