/**
 * Builds a directory the dev server can serve ANOTHER SDK release from, for an A/B
 * of one page against two releases:
 *
 *   node scripts/audit/sdk-override.ts <git-rev> <dir>
 *   SDK_DIST_OVERRIDE=<dir> npm run dev -- --port 5173 --host 127.0.0.1 --strictPort
 *
 * `<git-rev>` is a revision of THIS repo whose `package-lock.json` names the release
 * wanted (the commit before an upgrade PR, say). The versions are read from that
 * lockfile and installed exactly: `@opendaw/studio-sdk@x` on its own would not do,
 * because the meta-package depends on its sub-packages by caret range and some of
 * those ranges admit the next release's build.
 *
 * `vite.config.ts` re-points every `@opendaw/<pkg>/<subpath>` import at
 * `<override>/@opendaw/<pkg>/<subpath>`, past each package's `exports` map. So every
 * subpath a package exports from `dist/` gets a link beside `dist/` here.
 *
 * The packages end up in `<dir>/@opendaw`, moved OUT of `<dir>/node_modules`: Vite takes
 * anything under a `node_modules` path for a dependency to pre-bundle, and its optimizer
 * then fails on the `?url` and `?worker&url` subpath imports. Third-party dependencies
 * still resolve from `<dir>/node_modules`, two levels up from a package.
 * Delete `node_modules/.vite` before and after serving an override.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const [rev, target] = process.argv.slice(2);
if (rev === undefined || target === undefined) {
  console.error("usage: node scripts/audit/sdk-override.ts <git-rev> <dir>");
  process.exit(2);
}
const dir = resolve(target);

interface Lockfile { packages: Record<string, { version?: string }> }
const lockfile = JSON.parse(
  execFileSync("git", ["show", `${rev}:package-lock.json`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
) as Lockfile;
const versions: Record<string, string> = {};
for (const [path, entry] of Object.entries(lockfile.packages)) {
  const match = /^node_modules\/(@opendaw\/[^/]+)$/.exec(path);
  if (match !== null && entry.version !== undefined) versions[match[1]] = entry.version;
}
if (versions["@opendaw/studio-sdk"] === undefined) {
  console.error(`no @opendaw/studio-sdk in package-lock.json at ${rev}`);
  process.exit(1);
}
console.log(`@opendaw/studio-sdk@${versions["@opendaw/studio-sdk"]} as locked at ${rev}, ${Object.keys(versions).length} packages`);

mkdirSync(dir, { recursive: true });
rmSync(join(dir, "@opendaw"), { recursive: true, force: true });
rmSync(join(dir, "node_modules"), { recursive: true, force: true });
rmSync(join(dir, "package-lock.json"), { force: true });
// `overrides` holds every range inside the packages to the locked version as well
writeFileSync(
  join(dir, "package.json"),
  JSON.stringify({ name: "opendaw-sdk-override", private: true, dependencies: versions, overrides: versions }, null, 2) + "\n"
);
execFileSync("npm", ["install", "--no-audit", "--no-fund", "--ignore-scripts"], { cwd: dir, stdio: "inherit" });

const scope = join(dir, "@opendaw");
renameSync(join(dir, "node_modules", "@opendaw"), scope);
const mismatches: string[] = [];
let links = 0;
for (const name of readdirSync(scope)) {
  const packageDir = join(scope, name);
  const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as {
    version: string;
    exports?: Record<string, string | { default?: string }>;
  };
  const wanted = versions[`@opendaw/${name}`];
  if (manifest.version !== wanted) mismatches.push(`@opendaw/${name}: installed ${manifest.version}, locked ${String(wanted)}`);
  for (const [key, value] of Object.entries(manifest.exports ?? {})) {
    if (key === ".") continue;
    const exported = typeof value === "string" ? value : value.default;
    if (exported === undefined) continue;
    // "./wasm/*" -> "./dist/wasm/*" links the directory; "./x.js" -> "./dist/x.js" the file
    const from = join(packageDir, key.replace(/\/\*$/, ""));
    const to = join(packageDir, exported.replace(/\/\*$/, ""));
    if (existsSync(from) || !existsSync(to)) continue;
    mkdirSync(dirname(from), { recursive: true });
    symlinkSync(relative(dirname(from), to), from);
    links++;
  }
}
if (mismatches.length > 0) {
  console.error("installed versions differ from the lockfile:\n  " + mismatches.join("\n  "));
  process.exit(1);
}
console.log(`${links} export links written`);
console.log(`serve it with:\n  rm -rf node_modules/.vite && SDK_DIST_OVERRIDE=${dir} npm run dev -- --port 5173 --host 127.0.0.1 --strictPort`);
