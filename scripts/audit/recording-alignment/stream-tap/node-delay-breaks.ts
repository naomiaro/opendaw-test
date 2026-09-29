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
 * While a break is in, the unbroken source sits beside the file as
 * `<file>.unbroken`. An interrupt puts it back before the script ends. Should the
 * script be killed outright, the next run finds the copy, puts it back and says
 * so; by hand it is `mv <file>.unbroken <file>`.
 *
 * Run from the repo root, with nothing else writing to `src/`:
 *   node scripts/audit/recording-alignment/stream-tap/node-delay-breaks.ts
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

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
const files = [...new Set(breaks.map((entry) => entry.file))];
const testFiles = [...new Set(breaks.map((entry) => entry.test))];
const unbroken = (file: string): string => `${file}.unbroken`;

/** Put back every file that has its unbroken copy beside it. */
function restore(): string[] {
  const restored = files.filter((file) => existsSync(unbroken(file)));
  for (const file of restored) renameSync(unbroken(file), file);
  return restored;
}

let running: ChildProcess | null = null;

// Not spawnSync: while it blocks, and between two calls of it in a loop, no signal
// handler of this process gets to run.
function runTests(tests: string[]): Promise<{ passed: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawn("npx", ["vitest", "run", ...tests], { stdio: ["ignore", "pipe", "pipe"] });
    running = child;
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
    child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
    const done = (passed: boolean) => {
      if (running === child) running = null;
      resolve({ passed, output });
    };
    child.on("error", (error) => { output += String(error); done(false); });
    child.on("close", (code) => done(code === 0));
  });
}

function occurrences(text: string, piece: string): number {
  return text.split(piece).length - 1;
}

const leftOver = restore();
if (leftOver.length > 0) console.log(`put back from a run that did not end: ${leftOver.join(", ")}`);

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    running?.kill(signal);
    const restored = restore();
    console.log(`\n${signal}: ${restored.length > 0 ? `put back ${restored.join(", ")}` : "nothing was broken"}`);
    process.exit(130);
  });
}

const baseline = await runTests(testFiles);
if (!baseline.passed) {
  console.log(baseline.output.split("\n").slice(-40).join("\n"));
  throw new Error(`the tests fail before anything is broken: ${testFiles.join(", ")}`);
}
for (const entry of breaks) {
  const found = occurrences(readFileSync(entry.file, "utf8"), entry.find);
  if (found !== 1) throw new Error(`"${entry.name}": its piece of ${entry.file} is there ${found} times, not once`);
}

const survived: string[] = [];
const notCompiled: string[] = [];
for (const entry of breaks) {
  const original = readFileSync(entry.file, "utf8");
  try {
    writeFileSync(unbroken(entry.file), original);
    writeFileSync(entry.file, original.replace(entry.find, () => entry.replace));
    const { passed, output } = await runTests([entry.test]);
    // A break that does not parse fails every test without any test having noticed it.
    const compiled = !/Transform failed|SyntaxError|Failed to parse|Unexpected token/.test(output);
    console.log(`${passed ? "SURVIVED" : compiled ? "caught  " : "NO PARSE"} | ${entry.name}`);
    if (passed) survived.push(entry.name);
    else if (!compiled) notCompiled.push(entry.name);
  } finally {
    restore();
  }
}
console.log(`\n${breaks.length} breaks, ${breaks.length - survived.length - notCompiled.length} caught`);
if (notCompiled.length > 0) console.log(`did not parse, so nothing was tested: ${notCompiled.join("; ")}`);
if (survived.length > 0) console.log(`no test fails on: ${survived.join("; ")}`);
if (survived.length > 0 || notCompiled.length > 0) process.exitCode = 1;
