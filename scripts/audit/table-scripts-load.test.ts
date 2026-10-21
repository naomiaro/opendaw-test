import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// Each register table script runs under Node's type stripping. A value import that reaches the SDK's
// dist, whose imports carry no extensions, fails on load with ERR_MODULE_NOT_FOUND before any summary
// is read; vitest's bundling would never notice. The scripts are run with a run token that exists on
// no machine, so a loaded script exits through its own "no summary" message.
const ROOT = resolve(import.meta.dirname, "../..");
const SCRIPTS = [
  "scripts/audit/midi-input-alignment/table.ts",
  "scripts/audit/midi-audio-combined/table.ts",
  "scripts/audit/midi-effect-placement/table.ts",
  "scripts/audit/recording-alignment/one-quantum-events.ts",
];

describe("the audit table scripts load under Node", () => {
  for (const script of SCRIPTS) {
    it(script, () => {
      const result = spawnSync(process.execPath, [script, "1"], { cwd: ROOT, encoding: "utf8", timeout: 60_000 });
      expect(result.stderr).not.toMatch(/ERR_MODULE_NOT_FOUND|Cannot find module|SyntaxError/);
    });
  }
});
