import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const WEBSITE_ROOT = path.resolve("website");
const EXCLUDED_DIRS = new Set(["tests", "MF Marketing", "node_modules", ".git"]);
const SCANNED_EXTENSIONS = new Set([
  ".html",
  ".htm",
  ".js",
  ".mjs",
  ".json",
  ".xml",
  ".txt",
  ".config",
  ".ps1",
]);
const LEGACY_HOST_PATTERNS = [
  "monsoonfire.kilnfire.com",
  "https://monsoonfire.kilnfire.com",
];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      files.push(...(await walk(path.join(directory, entry.name))));
      continue;
    }

    const fullPath = path.join(directory, entry.name);
    const extension = path.extname(entry.name).toLowerCase();
    if (!SCANNED_EXTENSIONS.has(extension)) continue;

    files.push(fullPath);
  }

  return files;
}

test("website source never references the legacy kilnfire host", async () => {
  const files = await walk(WEBSITE_ROOT);
  const offenders = [];

  for (const file of files) {
    const contents = await readFile(file, "utf8");
    for (const pattern of LEGACY_HOST_PATTERNS) {
      if (contents.includes(pattern)) {
        offenders.push(`${path.relative(WEBSITE_ROOT, file)} :: ${pattern}`);
      }
    }
  }

  assert.deepEqual(offenders, [], `Legacy kilnfire host references found:\n${offenders.join("\n")}`);
});
