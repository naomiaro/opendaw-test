/**
 * Deliberate breaks of the node-delay verdict and measurement: each entry of
 * `node-delay-breaks.json` replaces one piece of source by a wrong one, runs the
 * test file that should notice, and puts the source back. A break no test fails
 * on is a gap in the tests.
 *
 * The baseline is run first and the script refuses to go on when it fails: on a
 * failing baseline every break reads as caught.
 *
 * An entry whose `find` is not in its file exactly once stops the run: the code
 * has moved on and the entry has to follow it.
 *
 * Run from the repo root, with nothing else writing to `src/`:
 *   node scripts/audit/recording-alignment/stream-tap/node-delay-breaks.ts
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

interface Break {
  file: string;
  test: string;
  name: string;
  find: string;
  replace: string;
}

const breaks = JSON.parse(
  readFileSync(new URL("./node-delay-breaks.json", import.meta.url), "utf8")
) as Break[];

function testsPass(testFiles: string[]): boolean {
  return spawnSync("npx", ["vitest", "run", ...testFiles], { stdio: "ignore" }).status === 0;
}

function occurrences(text: string, piece: string): number {
  return text.split(piece).length - 1;
}

const testFiles = [...new Set(breaks.map((entry) => entry.test))];
if (!testsPass(testFiles)) {
  throw new Error(`the tests fail before anything is broken: ${testFiles.join(", ")}`);
}
for (const entry of breaks) {
  const found = occurrences(readFileSync(entry.file, "utf8"), entry.find);
  if (found !== 1) throw new Error(`"${entry.name}": its piece of ${entry.file} is there ${found} times, not once`);
}

const survived: string[] = [];
for (const entry of breaks) {
  const original = readFileSync(entry.file, "utf8");
  try {
    writeFileSync(entry.file, original.replace(entry.find, () => entry.replace));
    const caught = !testsPass([entry.test]);
    console.log(`${caught ? "caught  " : "SURVIVED"} | ${entry.name}`);
    if (!caught) survived.push(entry.name);
  } finally {
    writeFileSync(entry.file, original);
  }
}
console.log(`\n${breaks.length} breaks, ${breaks.length - survived.length} caught`);
if (survived.length > 0) {
  console.log(`no test fails on: ${survived.join("; ")}`);
  process.exitCode = 1;
}
