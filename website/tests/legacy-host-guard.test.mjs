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
const ACCOUNT_HANDOFF_HOST = "monsoonfire.kilnfire.com";
const ACCOUNT_HANDOFF_URL = `https://${ACCOUNT_HANDOFF_HOST}`;
const ALLOWED_ACCOUNT_HANDOFF_FILES = new Set([
  "index.html",
  "firing-services/index.html",
  "support-pickup/index.html",
  "agent-service-catalog.json",
  "ai.txt",
  "llms.txt",
  "scripts/deploy-namecheap-website.mjs",
  "ncsitebuilder/index.html",
  "ncsitebuilder/firing-services/index.html",
  "ncsitebuilder/support-pickup/index.html",
  "ncsitebuilder/agent-service-catalog.json",
  "ncsitebuilder/ai.txt",
  "ncsitebuilder/llms.txt",
]);
const ACCOUNT_HANDOFF_PATTERN = /(?:https?:\/\/)?monsoonfire\.kilnfire\.com(?:\/[^\s"'<>)]*)?/g;
const FOOTER_HANDOFF_TARGET = 'data-portal-target="footer-studio-account"';

function isFooterAccountHandoff(contents, matchIndex) {
  const anchorStart = contents.lastIndexOf("<a", matchIndex);
  const anchorEnd = contents.indexOf("</a>", matchIndex);
  if (anchorStart === -1 || anchorEnd === -1) return false;

  const anchor = contents.slice(anchorStart, anchorEnd);
  return anchor.includes(FOOTER_HANDOFF_TARGET) && anchor.includes(">Studio account");
}

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

test("website source only references Kilnfire as the intentional account handoff host", async () => {
  const files = await walk(WEBSITE_ROOT);
  const offenders = [];

  for (const file of files) {
    const contents = await readFile(file, "utf8");
    const relative = path.relative(WEBSITE_ROOT, file).replace(/\\/g, "/");
    const matches = contents.matchAll(ACCOUNT_HANDOFF_PATTERN);
    for (const found of matches) {
      const match = found[0];
      const isExactProductionHost = match === ACCOUNT_HANDOFF_URL || match === ACCOUNT_HANDOFF_HOST;
      const isAllowedFile = ALLOWED_ACCOUNT_HANDOFF_FILES.has(relative);
      const isAllowedFooterHandoff = relative.endsWith(".html") && isFooterAccountHandoff(contents, found.index ?? -1);
      if (!isExactProductionHost || (!isAllowedFile && !isAllowedFooterHandoff)) {
        offenders.push(`${relative} :: ${match}`);
      }
    }
  }

  assert.deepEqual(offenders, [], `Unexpected Kilnfire host references found:\n${offenders.join("\n")}`);
});
