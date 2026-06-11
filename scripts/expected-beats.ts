// scripts/expected-beats.ts
// Print per-scenario expected onset times for the audio-verify skill.
// Run from the repo root: node scripts/expected-beats.ts  (Node >= 23, type stripping)
import { readFileSync } from "fs";
import { resolve } from "path";
import { parseBeatsFile } from "../src/lib/beats/beatsParser.ts";
import { computeExpectedTimes } from "../src/lib/beats/expectedTimes.ts";

const QUARTER = 960; // PPQN.Quarter — hardcoded; this script must stay SDK-free

const dir = import.meta.dirname ?? new URL(".", import.meta.url).pathname;
const beatsPath = resolve(dir, "../public/audio/Otherside.beats");
const markers = parseBeatsFile(readFileSync(beatsPath, "utf-8"));
const expected = computeExpectedTimes(markers, QUARTER);
process.stdout.write(JSON.stringify(expected, null, 2) + "\n");
