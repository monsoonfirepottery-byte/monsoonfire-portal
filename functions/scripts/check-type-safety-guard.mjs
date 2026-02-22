#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const TARGET_FILES = [
  "src/index.ts",
  "src/integrationEvents.ts",
  "src/jukebox.ts",
  "src/materials.ts",
];

const AS_ANY_PATTERN = /\bas\s+any\b/g;

let found = 0;
for (const relativePath of TARGET_FILES) {
  const absolutePath = resolve(process.cwd(), relativePath);
  const content = readFileSync(absolutePath, "utf8");
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    AS_ANY_PATTERN.lastIndex = 0;
    if (!AS_ANY_PATTERN.test(line)) return;
    found += 1;
    process.stderr.write(
      `[type-safety-guard] blocked unsafe cast in ${relativePath}:${index + 1}\n`
    );
  });
}

if (found > 0) {
  process.stderr.write(
    `[type-safety-guard] FAIL: found ${found} forbidden \"as any\" cast(s) in guarded files.\n`
  );
  process.exit(1);
}

process.stdout.write("[type-safety-guard] PASS: no \"as any\" casts found in guarded files.\n");
