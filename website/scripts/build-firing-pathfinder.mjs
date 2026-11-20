#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const websiteRoot = resolve(dirname(__filename), "..");
const sourceRoot = resolve(websiteRoot, "firing-pathfinder");
const distRoot = resolve(sourceRoot, "dist");
const targets = [
  resolve(websiteRoot, "firing-services", "pathfinder"),
  resolve(websiteRoot, "ncsitebuilder", "firing-services", "pathfinder"),
];

assertDirectory(sourceRoot, "pathfinder source");

const viteBin = resolve(sourceRoot, "node_modules", ".bin", process.platform === "win32" ? "vite.cmd" : "vite");
if (!existsSync(viteBin)) {
  runNpm(["ci"], sourceRoot);
}

runNpm(["run", "build"], sourceRoot);
assertDirectory(distRoot, "pathfinder build output");

for (const target of targets) {
  assertSafeTarget(target);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(dirname(target), { recursive: true });
  cpSync(distRoot, target, { recursive: true });
}

const sourceManifest = buildManifest(distRoot);
for (const target of targets) {
  const targetManifest = buildManifest(target);
  if (JSON.stringify(targetManifest) !== JSON.stringify(sourceManifest)) {
    throw new Error(`Generated pathfinder drifted at ${target}`);
  }
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  source: relative(websiteRoot, sourceRoot).replaceAll("\\", "/"),
  targets: targets.map((target) => relative(websiteRoot, target).replaceAll("\\", "/")),
  files: sourceManifest.length,
  bytes: sourceManifest.reduce((total, entry) => total + entry.bytes, 0),
}, null, 2)}\n`);

function runNpm(args, cwd) {
  if (process.platform === "win32") {
    run(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm", ...args], cwd);
    return;
  }
  run("npm", args, cwd);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function assertDirectory(pathValue, label) {
  if (!existsSync(pathValue) || !statSync(pathValue).isDirectory()) {
    throw new Error(`Missing ${label}: ${pathValue}`);
  }
}

function assertSafeTarget(target) {
  const allowed = new Set(targets);
  const relativeTarget = relative(websiteRoot, target);
  if (relativeTarget.startsWith("..") || !allowed.has(target)) {
    throw new Error(`Unsafe pathfinder target: ${target}`);
  }
}

function buildManifest(root) {
  return listFiles(root)
    .map((file) => {
      const contents = readFileSync(file);
      return {
        path: relative(root, file).replaceAll("\\", "/"),
        bytes: contents.length,
        sha256: createHash("sha256").update(contents).digest("hex"),
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

function listFiles(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const fullPath = resolve(root, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}
