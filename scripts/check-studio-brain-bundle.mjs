#!/usr/bin/env node

import { promises as fs } from "node:fs";
import { extname, resolve } from "node:path";

const defaultDir = resolve(process.cwd(), "web", "dist");
const targetDir = resolve(process.cwd(), process.argv[2] ?? defaultDir);
const showPath = targetDir.replace(/\\/g, "/");

const FILE_EXTENSIONS = new Set([".html", ".js", ".mjs", ".css", ".json", ".map", ".txt"]);

const BLOCK_LIST = [
  {
    label: "127.0.0.1:8787",
    pattern: /127\.0\.0\.1:8787/g
  },
  {
    label: "localhost:8787",
    pattern: /localhost:8787/g
  },
  {
    label: "http://[::1]:8787",
    pattern: /http:\/\/\[::1\]:8787/g
  },
  {
    label: "://[::1]",
    pattern: /:\/\/\[::1\]/g
  }
];

const toRelative = (base, absolute) => {
  if (absolute.startsWith(base)) {
    return absolute.slice(base.length).replace(/^\/+/, "");
  }
  return absolute;
};

const scanText = async (filePath, baseDir) => {
  const content = await fs.readFile(filePath, "utf8");
  const violations = [];

  for (const item of BLOCK_LIST) {
    if (!item.pattern.test(content)) {
      continue;
    }
    item.pattern.lastIndex = 0;
    let match;
    while ((match = item.pattern.exec(content))) {
      const index = match.index;
      const start = Math.max(0, index - 40);
      const end = Math.min(content.length, index + 80);
      violations.push({
        file: toRelative(baseDir, filePath),
        match: match[0],
        snippet: content.slice(start, end).replace(/\s+/g, " ").slice(0, 180)
      });
    }
    item.pattern.lastIndex = 0;
  }

  return violations;
};

const walk = async (directory, baseDir, results) => {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const child = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(child, baseDir, results);
      continue;
    }
    if (!FILE_EXTENSIONS.has(extname(child).toLowerCase())) {
      continue;
    }

    const violations = await scanText(child, baseDir);
    results.push(...violations);
  }
};

const run = async () => {
  const dirStat = await fs.stat(targetDir).catch(() => null);
  if (!dirStat || !dirStat.isDirectory()) {
    console.error(`Studio Brain bundle guard skipped: "${showPath}" does not exist.`);
    process.exitCode = 1;
    return;
  }

  const results = [];
  await walk(targetDir, targetDir, results);

  if (results.length === 0) {
    console.log(`PASS: no Studio Brain localhost artifacts found in ${targetDir}`);
    return;
  }

  console.error("FAIL: found forbidden Studio Brain artifacts in production bundle:");
  for (const item of results) {
    console.error(`- ${item.file}: ${item.match}`);
    console.error(`  ${item.snippet}`);
  }
  process.exitCode = 1;
};

run().catch((error) => {
  console.error("Studio Brain bundle guard failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
