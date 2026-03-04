#!/usr/bin/env node

/* eslint-disable no-console */

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const scriptDir = dirname(__filename);
const targetScript = resolve(scriptDir, "daily-interaction.mjs");

const result = spawnSync(process.execPath, [targetScript, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.exit(1);
